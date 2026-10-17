import { HttpContextToken } from "@angular/common/http";

/** Opt a public bearer-grant request out of account cookies and refresh replay. */
export const API_AUTHENTICATED = new HttpContextToken<boolean>(() => true);
