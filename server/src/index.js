import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'
import Razorpay from 'razorpay'
import { Resend } from 'resend'
import { User, Professional, Slot, Appointment } from './models/index.js'

const app = express()
const PORT = Number(process.env.PORT || 4000)
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) console.warn('WARNING: set JWT_SECRET to a long random secret in server/.env')
app.use(cors({ origin: CLIENT_URL.split(',').map(s => s.trim()), credentials: true }))
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = Buffer.from(buf) } }))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }))

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null
const safeUser = u => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, emailVerified: u.emailVerified })
const tokenFor = u => jwt.sign({ sub: String(u._id), role: u.role }, JWT_SECRET || 'development-only-change-me', { expiresIn: '7d' })
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const slugify = value => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'professional'
const publicProfessional = p => ({ id: String(p._id), name: p.name, slug: p.slug, category: p.category, description: p.description, phone: p.phone, fee: p.fee, mode: p.mode, slotDurationMinutes: p.slotDurationMinutes, meetLink: p.meetLink, officeAddress: p.officeAddress, timezone: p.timezone })

async function sendEmail(to, subject, html) {
  if (!resend || !process.env.RESEND_FROM_EMAIL) return false
  await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL, to, subject, html })
  return true
}
function auth(requiredRole) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || ''
      const token = header.startsWith('Bearer ') ? header.slice(7) : ''
      if (!token) return res.status(401).json({ error: 'Please sign in to continue.' })
      const payload = jwt.verify(token, JWT_SECRET || 'development-only-change-me')
      const user = await User.findById(payload.sub)
      if (!user) return res.status(401).json({ error: 'Account not found.' })
      if (requiredRole && user.role !== requiredRole) return res.status(403).json({ error: `This action requires a ${requiredRole} account.` })
      req.user = user
      next()
    } catch { return res.status(401).json({ error: 'Your session has expired. Please sign in again.' }) }
  }
}
const errorHandler = (err, req, res, next) => {
  console.error(err)
  if (err?.code === 11000) return res.status(409).json({ error: 'That email, booking slug, or time slot is already in use.' })
  res.status(err.status || 500).json({ error: err.message || 'Unexpected server error.' })
}
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'AppointFlow API', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }))

app.post('/api/auth/register', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' && !resend) return res.status(503).json({ error: 'Email verification is not configured. Configure Resend before accepting registrations.' })
    const { name, email, password, role = 'customer' } = req.body || {}
    if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Enter your name, a valid email, and a password with at least 8 characters.' })
    if (!['customer', 'professional'].includes(role)) return res.status(400).json({ error: 'Choose a valid account type.' })
    const user = await User.create({ name: name.trim(), email: email.toLowerCase().trim(), passwordHash: await bcrypt.hash(password, 12), role, emailVerified: !resend })
    if (role === 'professional') {
      const base = slugify(name)
      let slug = base, i = 2
      while (await Professional.exists({ slug })) slug = `${base}-${i++}`
      await Professional.create({ user: user._id, name: user.name, slug, fee: 799 })
    }
    if (resend) {
      const raw = crypto.randomBytes(32).toString('hex')
      user.emailVerificationTokenHash = hash(raw)
      user.emailVerificationExpiresAt = new Date(Date.now() + 60 * 60 * 1000)
      await user.save()
      const url = `${CLIENT_URL}/verify-email?token=${raw}`
      await sendEmail(user.email, 'Verify your AppointFlow email', `<p>Hello ${user.name},</p><p>Verify your email to finish setting up AppointFlow.</p><p><a href="${url}">Verify email address</a></p><p>This link expires in one hour.</p>`)
      return res.status(201).json({ message: 'Account created. Check your inbox to verify your email before signing in.', requiresVerification: true })
    }
    res.status(201).json({ message: 'Account created. You can sign in now.', token: tokenFor(user), user: safeUser(user) })
  } catch (e) { next(e) }
})
app.post('/api/auth/verify-email', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '')
    const user = await User.findOne({ emailVerificationTokenHash: hash(token), emailVerificationExpiresAt: { $gt: new Date() } })
    if (!user) return res.status(400).json({ error: 'This verification link is invalid or has expired. Request a new one.' })
    user.emailVerified = true; user.emailVerificationTokenHash = undefined; user.emailVerificationExpiresAt = undefined; await user.save()
    res.json({ message: 'Email verified. You can now sign in.' })
  } catch (e) { next(e) }
})
app.post('/api/auth/resend-verification', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim()
    const user = await User.findOne({ email })
    if (!user || user.emailVerified || !resend) return res.json({ message: 'If the account needs verification, an email will be sent when available.' })
    const raw = crypto.randomBytes(32).toString('hex'); user.emailVerificationTokenHash = hash(raw); user.emailVerificationExpiresAt = new Date(Date.now() + 3600000); await user.save()
    await sendEmail(user.email, 'Verify your AppointFlow email', `<p><a href="${CLIENT_URL}/verify-email?token=${raw}">Verify email address</a></p>`)
    res.json({ message: 'If the account needs verification, an email will be sent when available.' })
  } catch (e) { next(e) }
})
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim()
    const user = await User.findOne({ email }).select('+passwordHash')
    if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' })
    if (!user.emailVerified) return res.status(403).json({ error: 'Please verify your email before signing in.', needsVerification: true })
    res.json({ token: tokenFor(user), user: safeUser(user) })
  } catch (e) { next(e) }
})
app.get('/api/auth/me', auth(), (req, res) => res.json({ user: safeUser(req.user) }))
app.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim(), user = await User.findOne({ email })
    if (user && resend) {
      const raw = crypto.randomBytes(32).toString('hex'); user.resetTokenHash = hash(raw); user.resetTokenExpiresAt = new Date(Date.now() + 3600000); await user.save()
      await sendEmail(user.email, 'Reset your AppointFlow password', `<p><a href="${CLIENT_URL}/reset-password?token=${raw}">Reset password</a></p><p>This link expires in one hour.</p>`)
    }
    res.json({ message: 'If an account exists for that email, a password reset link will be sent.' })
  } catch (e) { next(e) }
})
app.post('/api/auth/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body?.token || ''), password = String(req.body?.password || '')
    if (password.length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters.' })
    const user = await User.findOne({ resetTokenHash: hash(token), resetTokenExpiresAt: { $gt: new Date() } }).select('+passwordHash')
    if (!user) return res.status(400).json({ error: 'Reset link is invalid or expired.' })
    user.passwordHash = await bcrypt.hash(password, 12); user.resetTokenHash = undefined; user.resetTokenExpiresAt = undefined; await user.save()
    res.json({ message: 'Password updated. You can sign in now.' })
  } catch (e) { next(e) }
})

app.get('/api/professionals', async (req, res, next) => {
  try { const list = await Professional.find({ published: true }).sort({ name: 1 }).limit(100); res.json({ professionals: list.map(publicProfessional) }) } catch (e) { next(e) }
})
app.get('/api/professionals/:slug', async (req, res, next) => {
  try {
    const p = await Professional.findOne({ slug: req.params.slug, published: true })
    if (!p) return res.status(404).json({ error: 'Professional booking page not found.' })
    const from = new Date(); from.setHours(0,0,0,0)
    const slots = await Slot.find({ professional: p._id, active: true, date: { $gte: from.toISOString().slice(0,10) } }).sort({ date: 1, time: 1 }).limit(200)
    const appointments = await Appointment.find({ professional: p._id, status: { $in: ['pending_payment','pending_scheduling','confirmed'] } }).select('requestedDate requestedTime finalDate finalTime slot status')
    const taken = new Set(appointments.map(a => `${a.finalDate || a.requestedDate}|${a.finalTime || a.requestedTime}`))
    res.json({ professional: publicProfessional(p), slots: slots.filter(s => !taken.has(`${s.date}|${s.time}`)).map(s => ({ id: String(s._id), date: s.date, time: s.time })) })
  } catch (e) { next(e) }
})
app.get('/api/professional/profile', auth('professional'), async (req, res, next) => {
  try { const p = await Professional.findOne({ user: req.user._id }); res.json({ professional: p ? publicProfessional(p) : null }) } catch (e) { next(e) }
})
app.put('/api/professional/profile', auth('professional'), async (req, res, next) => {
  try {
    const p = await Professional.findOne({ user: req.user._id })
    if (!p) return res.status(404).json({ error: 'Professional profile not found.' })
    const b = req.body || {}
    if (b.name !== undefined) p.name = String(b.name).trim().slice(0,100)
    if (b.category !== undefined) p.category = String(b.category).trim().slice(0,100)
    if (b.description !== undefined) p.description = String(b.description).trim().slice(0,2000)
    if (b.phone !== undefined) p.phone = String(b.phone).trim().slice(0,30)
    if (b.fee !== undefined && Number(b.fee) >= 1 && Number(b.fee) <= 1000000) p.fee = Number(b.fee)
    if (['online','offline','both'].includes(b.mode)) p.mode = b.mode
    if ([15,30,45,60,90,120].includes(Number(b.slotDurationMinutes))) p.slotDurationMinutes = Number(b.slotDurationMinutes)
    if (b.meetLink !== undefined) { const v = String(b.meetLink).trim(); if (v && !/^https:\/\//i.test(v)) return res.status(400).json({ error: 'Meeting link must start with https://' }); p.meetLink = v }
    if (b.officeAddress !== undefined) p.officeAddress = String(b.officeAddress).trim().slice(0,500)
    if (b.slug !== undefined) { const slug = slugify(String(b.slug)); if (await Professional.exists({ slug, _id: { $ne: p._id } })) return res.status(409).json({ error: 'That booking URL is already taken.' }); p.slug = slug }
    await p.save(); res.json({ professional: publicProfessional(p) })
  } catch (e) { next(e) }
})
app.post('/api/professional/slots', auth('professional'), async (req, res, next) => {
  try {
    const p = await Professional.findOne({ user: req.user._id }); if (!p) return res.status(404).json({ error: 'Professional profile not found.' })
    const { date, times } = req.body || {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < new Date().toISOString().slice(0,10) || !Array.isArray(times) || !times.length || times.length > 50) return res.status(400).json({ error: 'Choose a valid future date and at least one time.' })
    const created = []
    for (const time of times) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue; try { created.push(await Slot.create({ professional: p._id, date, time })) } catch (e) { if (e.code !== 11000) throw e } }
    res.status(201).json({ message: `${created.length} availability slot(s) saved.`, slots: created.map(s => ({ id: String(s._id), date: s.date, time: s.time })) })
  } catch (e) { next(e) }
})
app.get('/api/professional/slots', auth('professional'), async (req, res, next) => {
  try { const p = await Professional.findOne({ user: req.user._id }); const slots = p ? await Slot.find({ professional: p._id, active: true, date: { $gte: new Date().toISOString().slice(0,10) } }).sort({ date: 1, time: 1 }).limit(300) : []; res.json({ slots: slots.map(s => ({ id: String(s._id), date: s.date, time: s.time })) }) } catch (e) { next(e) }
})
app.delete('/api/professional/slots/:id', auth('professional'), async (req, res, next) => {
  try { const p = await Professional.findOne({ user: req.user._id }); const slot = await Slot.findOne({ _id: req.params.id, professional: p?._id }); if (!slot) return res.status(404).json({ error: 'Slot not found.' }); const used = await Appointment.exists({ slot: slot._id, status: { $nin: ['cancelled','payment_failed'] } }); if (used) return res.status(409).json({ error: 'This slot has an appointment and cannot be removed.' }); await slot.deleteOne(); res.json({ message: 'Availability removed.' }) } catch (e) { next(e) }
})

app.post('/api/appointments', auth('customer'), async (req, res, next) => {
  try {
    const { slug, date, time, mode, reason, description = '', phone } = req.body || {}
    const p = await Professional.findOne({ slug, published: true })
    if (!p) return res.status(404).json({ error: 'Professional not found.' })
    if (!['online','offline'].includes(mode) || (p.mode !== 'both' && p.mode !== mode)) return res.status(400).json({ error: 'That appointment mode is not offered by this professional.' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < new Date().toISOString().slice(0,10) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') || !String(reason || '').trim() || !String(phone || '').trim()) return res.status(400).json({ error: 'Enter a valid date, time, phone number, and appointment reason.' })
    const slot = await Slot.findOne({ professional: p._id, date, time, active: true })
    if (!slot) return res.status(409).json({ error: 'That time is not available. Refresh the page and choose another slot.' })
    const taken = await Appointment.exists({ professional: p._id, status: { $in: ['pending_payment','pending_scheduling','confirmed'] }, $or: [{ slot: slot._id }, { requestedDate: date, requestedTime: time }, { finalDate: date, finalTime: time }] })
    if (taken) return res.status(409).json({ error: 'That slot was just booked. Please choose another time.' })
    if (!razorpay) return res.status(503).json({ error: 'Online payment is not configured yet. Add Razorpay test credentials in server/.env.' })
    const appointment = await Appointment.create({ customer: req.user._id, professional: p._id, slot: slot._id, customerName: req.user.name, customerEmail: req.user.email, customerPhone: String(phone).trim(), reason: String(reason).trim().slice(0,300), description: String(description).trim().slice(0,2000), mode, requestedDate: date, requestedTime: time, fee: p.fee, status: 'pending_payment', paymentStatus: 'pending' })
    try {
      const order = await razorpay.orders.create({ amount: Math.round(p.fee * 100), currency: 'INR', receipt: `af_${String(appointment._id).slice(-18)}`, notes: { appointmentId: String(appointment._id), professionalId: String(p._id), customerId: String(req.user._id) } })
      appointment.razorpayOrderId = order.id; await appointment.save()
      res.status(201).json({ appointment: { id: String(appointment._id), status: appointment.status, fee: appointment.fee }, order: { id: order.id, amount: order.amount, currency: order.currency }, keyId: process.env.RAZORPAY_KEY_ID, professional: publicProfessional(p) })
    } catch (e) { appointment.status = 'payment_failed'; appointment.paymentStatus = 'failed'; await appointment.save(); throw e }
  } catch (e) { next(e) }
})
app.post('/api/payments/verify', auth('customer'), async (req, res, next) => {
  try {
    const { appointmentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {}
    const appointment = await Appointment.findOne({ _id: appointmentId, customer: req.user._id })
    if (!appointment || !appointment.razorpayOrderId || appointment.razorpayOrderId !== razorpay_order_id) return res.status(404).json({ error: 'Appointment or payment order not found.' })
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex')
    const supplied = String(razorpay_signature || '')
    if (!process.env.RAZORPAY_KEY_SECRET || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)) ) return res.status(400).json({ error: 'Payment signature could not be verified.' })
    const payment = await razorpay.payments.fetch(razorpay_payment_id)
    if (payment.order_id !== razorpay_order_id || payment.status !== 'captured' || payment.amount !== Math.round(appointment.fee * 100)) return res.status(400).json({ error: 'Payment is not captured or amount does not match.' })
    appointment.razorpayPaymentId = razorpay_payment_id; appointment.paymentStatus = 'paid'; appointment.status = 'pending_scheduling'; await appointment.save()
    const p = await Professional.findById(appointment.professional).populate('user', 'email name')
    if (p?.user?.email) await sendEmail(p.user.email, 'New paid AppointFlow booking', `<p>You have a new paid appointment request from ${appointment.customerName}.</p><p>Requested time: ${appointment.requestedDate} at ${appointment.requestedTime}.</p><p>Open your AppointFlow dashboard to finalize the appointment.</p>`)
    await sendEmail(appointment.customerEmail, 'AppointFlow payment received', `<p>Your payment of ₹${appointment.fee} was verified.</p><p>Your requested time is ${appointment.requestedDate} at ${appointment.requestedTime}. The professional will confirm the final appointment details.</p>`)
    res.json({ message: 'Payment verified. Your appointment request has been sent to the professional.', appointment: { id: String(appointment._id), status: appointment.status, paymentStatus: appointment.paymentStatus } })
  } catch (e) { next(e) }
})
app.get('/api/appointments/mine', auth(), async (req, res, next) => {
  try {
    let query = {}
    if (req.user.role === 'customer') query.customer = req.user._id
    else { const p = await Professional.findOne({ user: req.user._id }); if (!p) return res.json({ appointments: [] }); query.professional = p._id }
    const list = await Appointment.find(query).populate('professional', 'name slug category fee meetLink officeAddress').populate('customer', 'name email').sort({ createdAt: -1 }).limit(200)
    res.json({ appointments: list.map(a => ({ id: String(a._id), customer: a.customer ? { name: a.customer.name, email: a.customer.email } : null, professional: a.professional ? { name: a.professional.name, slug: a.professional.slug, category: a.professional.category } : null, customerName: a.customerName, customerEmail: a.customerEmail, customerPhone: a.customerPhone, reason: a.reason, description: a.description, mode: a.mode, requestedDate: a.requestedDate, requestedTime: a.requestedTime, finalDate: a.finalDate, finalTime: a.finalTime, meetingLink: a.meetingLink, officeAddress: a.officeAddress, fee: a.fee, status: a.status, paymentStatus: a.paymentStatus, createdAt: a.createdAt })) })
  } catch (e) { next(e) }
})
app.patch('/api/appointments/:id/finalize', auth('professional'), async (req, res, next) => {
  try {
    const p = await Professional.findOne({ user: req.user._id }), { date, time, meetingLink = '', officeAddress = '' } = req.body || {}
    const a = await Appointment.findOne({ _id: req.params.id, professional: p?._id, paymentStatus: 'paid', status: 'pending_scheduling' })
    if (!a) return res.status(404).json({ error: 'Paid appointment waiting for scheduling was not found.' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < new Date().toISOString().slice(0,10) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return res.status(400).json({ error: 'Choose a valid future date and time.' })
    if (a.mode === 'online' && !/^https:\/\//i.test(meetingLink || p.meetLink || '')) return res.status(400).json({ error: 'Provide a valid HTTPS meeting link for online appointments.' })
    if (a.mode === 'offline' && !String(officeAddress || p.officeAddress || '').trim()) return res.status(400).json({ error: 'Provide the in-person appointment address.' })
    const publishedSlot = await Slot.findOne({ professional: p._id, date, time, active: true })
    if (!publishedSlot) return res.status(400).json({ error: 'Choose a time published in your Availability page before confirming this appointment.' })
    const collision = await Appointment.exists({ _id: { $ne: a._id }, professional: p._id, status: 'confirmed', finalDate: date, finalTime: time })
    if (collision) return res.status(409).json({ error: 'That final time is already booked.' })
    a.finalDate = date; a.finalTime = time; a.meetingLink = a.mode === 'online' ? (meetingLink || p.meetLink) : ''; a.officeAddress = a.mode === 'offline' ? (officeAddress || p.officeAddress) : ''; a.status = 'confirmed'; await a.save()
    const dateText = `${date} at ${time}`
    await sendEmail(a.customerEmail, 'Your AppointFlow appointment is confirmed', `<p>Hello ${a.customerName},</p><p>Your appointment is confirmed for ${dateText}.</p><p>${a.mode === 'online' ? `Meeting link: <a href="${a.meetingLink}">${a.meetingLink}</a>` : `Visit address: ${a.officeAddress}`}</p>`)
    await sendEmail(req.user.email, 'AppointFlow appointment confirmed', `<p>You confirmed ${a.customerName} for ${dateText}.</p>`)
    res.json({ message: 'Appointment confirmed and email notifications queued.', appointment: { id: String(a._id), status: a.status, finalDate: a.finalDate, finalTime: a.finalTime } })
  } catch (e) { next(e) }
})
app.patch('/api/appointments/:id/cancel', auth(), async (req, res, next) => {
  try {
    const a = await Appointment.findById(req.params.id)
    if (!a) return res.status(404).json({ error: 'Appointment not found.' })
    const owns = req.user.role === 'customer' ? String(a.customer) === String(req.user._id) : String((await Professional.findOne({ user: req.user._id }))?._id) === String(a.professional)
    if (!owns) return res.status(403).json({ error: 'You cannot cancel this appointment.' })
    if (['cancelled','completed'].includes(a.status)) return res.status(409).json({ error: 'This appointment can no longer be cancelled.' })
    if (a.status === 'confirmed' && a.finalDate && a.finalDate < new Date().toISOString().slice(0,10)) return res.status(409).json({ error: 'Past appointments cannot be cancelled.' })
    a.status = 'cancelled'; a.cancellationReason = String(req.body?.reason || 'Cancelled by account owner').slice(0,300); await a.save()
    res.json({ message: 'Appointment cancelled. If a refund is due, handle it through the payment provider.', appointment: { id: String(a._id), status: a.status } })
  } catch (e) { next(e) }
})
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature']
    const rawBody = req.rawBody
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '').update(rawBody || Buffer.alloc(0)).digest('hex')
    if (!process.env.RAZORPAY_WEBHOOK_SECRET || !rawBody || typeof signature !== 'string' || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(400).send('Invalid webhook signature')
    const event = JSON.parse(rawBody.toString())
    if (event.event === 'payment.captured') {
      const entity = event.payload?.payment?.entity
      if (entity?.order_id) await Appointment.updateOne({ razorpayOrderId: entity.order_id, status: 'pending_payment' }, { $set: { razorpayPaymentId: entity.id, paymentStatus: 'paid', status: 'pending_scheduling' } })
    }
    res.json({ received: true })
  } catch { res.status(400).send('Invalid webhook') }
})
app.post('/api/cron/reminders', async (req, res, next) => {
  try {
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })
    const now = new Date(), start = new Date(now.getTime() + 25 * 60000), end = new Date(now.getTime() + 35 * 60000)
    const date = start.toISOString().slice(0,10)
    const list = await Appointment.find({ status: 'confirmed', paymentStatus: 'paid', finalDate: date, reminderSentAt: null })
    let sent = 0
    for (const a of list) {
      const when = new Date(`${a.finalDate}T${a.finalTime}:00+05:30`)
      if (when < start || when > end) continue
      const p = await Professional.findById(a.professional).populate('user', 'email')
      await sendEmail(a.customerEmail, 'AppointFlow appointment reminder', `<p>Reminder: your appointment is in about 30 minutes.</p><p>${a.mode === 'online' ? `Join: ${a.meetingLink}` : `Location: ${a.officeAddress}`}</p>`)
      if (p?.user?.email) await sendEmail(p.user.email, 'AppointFlow appointment reminder', `<p>Reminder: appointment with ${a.customerName} is in about 30 minutes.</p>`)
      a.reminderSentAt = new Date(); await a.save(); sent++
    }
    res.json({ sent })
  } catch (e) { next(e) }
})
app.post('/api/cron/cleanup-pending-bookings', async (req, res, next) => {
  try {
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })
    const cutoff = new Date(Date.now() - 20 * 60 * 1000)
    const result = await Appointment.updateMany({ status: 'pending_payment', paymentStatus: 'pending', createdAt: { $lt: cutoff } }, { $set: { status: 'payment_failed', paymentStatus: 'failed' } })
    res.json({ expired: result.modifiedCount })
  } catch (e) { next(e) }
})

app.use(errorHandler)
let MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ganeshthirumalapudi1101_db_user:gBskJbBYRjMJnqAU@appointflow.9lthuff.mongodb.net'
if (!MONGODB_URI) console.error('MONGODB_URI is required. Copy server/.env.example to server/.env and configure it.')
else mongoose.connect(MONGODB_URI).then(() => app.listen(PORT, () => console.log(`AppointFlow API running at http://localhost:${PORT}`))).catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1) })
