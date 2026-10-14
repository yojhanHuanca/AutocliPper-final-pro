import { z } from 'zod';

export const INSPECTION_QUEUE = 'autoclipper-media-inspection-v1';
// Internal transport, never accepted directly from an unauthenticated client.
export const inspectionEvent = z.object({ version: z.literal(1), taskId: z.uuid(), correlationId: z.uuid() }).strict();
export type InspectionEvent = z.infer<typeof inspectionEvent>;
