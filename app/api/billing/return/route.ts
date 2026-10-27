import { NextResponse, type NextRequest } from "next/server";

// Where Cashfree's checkout sends the owner back: a form POST after a mandate, a GET after an
// order. What happened is decided by the signed webhook alone, so this only opens Billing,
// which says whether the payment is in or still on its way.
const back = (request: NextRequest) => NextResponse.redirect(new URL("/app/settings?group=billing&saved=checkout", process.env.APP_BASE_URL ?? request.url), 303);
export const GET = back;
export const POST = back;
