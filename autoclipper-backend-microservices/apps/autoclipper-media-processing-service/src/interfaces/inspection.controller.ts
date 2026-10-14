import {
  Body,
  Controller,
  Post,
  Req,
  Inject,
  HttpCode,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { body, requireInternal } from "@autoclipper/http-security";
import { InspectionRuntime } from "../application/inspection-runtime.js";
import { inspectionTasks, inspectionOutbox } from "../infrastructure/schema.js";
import { validateObjectKey } from "../domain/inspection.js";
@ApiExcludeController()
@Controller("internal")
export class InspectionController {
  constructor(@Inject(InspectionRuntime) readonly runtime: InspectionRuntime) {}
  @Post("inspections") @HttpCode(200) async submit(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    requireInternal(req, this.runtime.config);
    const data = body(
      z
        .object({
          id: z.uuid(),
          workspaceId: z.uuid(),
          objectKey: z.string().max(512),
          expectedBytes: z.number().int().positive().max(104857600),
          expectedEtag: z.string().min(1).max(200),
          expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
          correlationId: z.uuid(),
        })
        .strict(),
      input,
    );
    validateObjectKey(data.objectKey, data.workspaceId);
    await this.runtime.db.transaction(async (tx) => {
      await tx.insert(inspectionTasks).values(data).onConflictDoNothing();
      const [task] = await tx
        .select()
        .from(inspectionTasks)
        .where(eq(inspectionTasks.id, data.id));
      if (
        !task ||
        task.workspaceId !== data.workspaceId ||
        task.objectKey !== data.objectKey ||
        task.expectedBytes !== data.expectedBytes ||
        task.expectedEtag !== data.expectedEtag ||
        task.expectedSha256 !== data.expectedSha256
      )
        throw new ConflictException();
      await tx
        .insert(inspectionOutbox)
        .values({ taskId: data.id, correlationId: task.correlationId })
        .onConflictDoNothing();
    });
    return { id: data.id };
  }
  @Post("inspection-status") @HttpCode(200) async status(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    requireInternal(req, this.runtime.config);
    const data = body(
      z.object({ id: z.uuid(), workspaceId: z.uuid() }).strict(),
      input,
    );
    const [task] = await this.runtime.db
      .select()
      .from(inspectionTasks)
      .where(
        and(
          eq(inspectionTasks.id, data.id),
          eq(inspectionTasks.workspaceId, data.workspaceId),
        ),
      );
    if (!task) throw new NotFoundException();
    return {
      id: task.id,
      status: task.status,
      result: task.result,
      errorCode: task.errorCode,
      attempts: task.attempts,
      startedAt: task.startedAt?.toISOString() ?? null,
      finishedAt: task.finishedAt?.toISOString() ?? null,
    };
  }
}
