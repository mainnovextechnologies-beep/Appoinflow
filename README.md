# AppointFlow — Customer + Professional Appointment Platform

AppointFlow is a React + Vite + TypeScript frontend with a Node.js + Express API and MongoDB Atlas database. It includes separate customer and professional workspaces, a public professional directory, booking pages, Razorpay checkout and server-side payment verification, profile/availability management, appointment finalization, email verification/password reset when Resend is configured, and reminder/cleanup endpoints.

> This is an implementation starter, not a deployed production service. You must configure your own MongoDB, JWT, Razorpay, email and hosting credentials and complete end-to-end testing before live use. No credentials are included.

## Main modules

### Customer portal
- Customer registration, sign-in, email verification (when Resend is configured), forgot/reset password.
- Browse and search published professionals.
- View fees, offered appointment modes and published availability.
- Book an appointment, pay through Razorpay Checkout and rely on server-side signature/payment verification.
- See all personal appointments, status and payment state.
- Open confirmed online meeting links or view in-person location.
- Cancel eligible appointments.

### Professional portal
- Professional registration creates an initial public profile and booking slug.
- Edit profile, category, fee, mode, session duration, meeting link and office address.
- Publish and remove availability slots.
- Review customer appointment requests and payment status.
- Finalize paid appointment requests with date/time and meeting link or location.
- View appointments and cancel eligible bookings.

## Technology

- Frontend: React, Vite, TypeScript, React Router, Lucide, CSS.
- Backend: Node.js, Express, Mongoose, JWT, bcrypt.
- Database: MongoDB Atlas.
- Payments: Razorpay orders, signature verification, payment API check and webhook verification.
- Email: Resend (optional but required for real verification/reset/confirmation emails).

## 1. Requirements

- Node.js 20 or newer and npm.
- MongoDB Atlas cluster or a local MongoDB instance.
- Razorpay test account for checkout testing.
- Resend account and verified sender domain for outbound email.

## 2. Configure MongoDB and API

1. Create a MongoDB Atlas cluster and database user.
2. In Network Access, allow the development machine IP. Avoid `0.0.0.0/0` for production unless you understand the exposure.
3. Copy `server/.env.example` to `server/.env`.
4. Set `MONGODB_URI`, a long random `JWT_SECRET` (at least 32 characters), and `CLIENT_URL=http://localhost:5173`.
5. Add Razorpay test credentials to `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
6. Add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` after verifying your sending domain. If Resend is configured, accounts require email verification; if not configured, development registrations are immediately usable.
7. Set `RAZORPAY_WEBHOOK_SECRET` and a long random `CRON_SECRET`.

Example URI (replace placeholders; never commit real credentials):

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-host>/appointflow?retryWrites=true&w=majority
```

## 3. Run locally on Windows

Open two terminal windows from the project root.

Terminal A — API:

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run dev
```

Fill `server/.env` before starting. API health endpoint: `http://localhost:4000/api/health`.

Terminal B — frontend:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

## 4. Test the two user roles

1. Register a **Professional** account.
2. Open **Public profile** in its dashboard and set the display name, public slug, category, fee, mode and meeting/location details.
3. Open **Availability** and publish one or more future dates and times.
4. Sign out and register a separate **Customer** account.
5. Use **Find a professional**, open the professional's public page, choose one of the published slots and proceed to Razorpay test checkout.
6. Complete a test payment. The backend checks the Razorpay signature and fetches the payment status before moving the booking to `pending_scheduling`.
7. Sign back in as the professional, open **Appointments**, and finalize the paid request. The customer can then see confirmed date/time and meeting/location details in **My appointments**.
8. Test cancellations, invalid payment signatures, duplicate bookings, unavailable slots and email delivery before launch.

## 5. Razorpay webhook

Configure a webhook in the Razorpay dashboard pointing to:

`https://YOUR_API_DOMAIN/api/webhooks/razorpay`

Use the same webhook secret as `RAZORPAY_WEBHOOK_SECRET`. Subscribe to `payment.captured`. The webhook is signature-checked; the frontend does not get to mark a payment as paid by itself.

## 6. Email and scheduled jobs

Configure Resend sender domain and set `RESEND_API_KEY` plus `RESEND_FROM_EMAIL` in `server/.env`. Verification, password reset and booking emails use this provider. Without Resend configured, emails are not sent.

Call these endpoints from a trusted scheduler, with `x-cron-secret: <CRON_SECRET>`:

- `POST https://YOUR_API_DOMAIN/api/cron/reminders` — looks for confirmed paid appointments in the 25–35 minute reminder window.
- `POST https://YOUR_API_DOMAIN/api/cron/cleanup-pending-bookings` — expires unpaid checkouts older than 20 minutes.

Do not expose the cron secret in the frontend.

## 7. Environment variable placement

- `VITE_API_URL` belongs in the frontend `.env.local`; it contains only the public API base URL.
- `MONGODB_URI`, `JWT_SECRET`, Razorpay secret, webhook secret, Resend API key and `CRON_SECRET` belong only in `server/.env` or your hosting provider's backend secret store.
- Never prefix backend secrets with `VITE_` and never commit either environment file.

## 8. Deployment

Deploy the frontend and API separately. Set `VITE_API_URL` to your deployed API URL in the frontend host. Set the server environment variables in the API host, configure MongoDB Atlas network access, and set `CLIENT_URL` to the deployed frontend origin. Configure Razorpay webhook and scheduled jobs using the deployed API URL. Add HTTPS, logging/monitoring, backups, rate-limit review, privacy/terms/refund policies and production security review before real payments.

## Current limitations to review before production

- Refund processing and automated payment refunds are not implemented; cancelling an appointment does not itself issue a refund.
- Payment failure and browser-dismissal behavior must be tested with Razorpay test mode; stale pending checkouts are cleaned only when the cleanup endpoint is scheduled.
- Slot conflict checks should be strengthened with a transactional/atomic reservation strategy before high-concurrency production traffic.
- Reminder times assume India Standard Time for the final appointment time. Expand timezone handling before serving other time zones.
- The API is not deployed, and no external accounts are connected by this source archive.
