import { NextResponse, type NextRequest } from "next/server";

// Where Cashfree's checkout sends the owner back: a form POST after a mandate, a GET after an
// order. What happened is decided by the signed webhook alone, so this only opens Billing, or
// sign up's plan and payment step for a first payment, which says whether it is in yet.
const back = (request: NextRequest) => NextResponse.redirect(new URL(request.nextUrl.searchParams.get("to") === "start" ? "/start?paid=1" : "/app/settings?group=billing&saved=checkout", process.env.APP_BASE_URL ?? request.url), 303);
export const GET = back;
export const POST = back;
