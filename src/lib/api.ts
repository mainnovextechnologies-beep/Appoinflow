const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000/api'
export type Account = { id: string; name: string; email: string; role: 'customer' | 'professional'; emailVerified: boolean }
export type Professional = { id: string; name: string; slug: string; category: string; description: string; phone: string; fee: number; mode: 'online' | 'offline' | 'both'; slotDurationMinutes: number; meetLink: string; officeAddress: string; timezone: string }
export type Slot = { id: string; date: string; time: string }
export type Appointment = { id: string; customer?: {name:string;email:string}|null; professional?: {name:string;slug:string;category:string}|null; customerName:string; customerEmail:string; customerPhone:string; reason:string; description:string; mode:'online'|'offline'; requestedDate:string; requestedTime:string; finalDate:string; finalTime:string; meetingLink:string; officeAddress:string; fee:number; status:string; paymentStatus:string; createdAt:string }
export const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
export const friendlyDate = (date: string, time?: string) => date ? new Date(`${date}T${time || '12:00'}:00`).toLocaleString('en-IN', { dateStyle: 'medium', ...(time ? { timeStyle: 'short' as const } : {}) }) : 'Not scheduled yet'
export function getToken() { return localStorage.getItem('appointflow_token') || '' }
export function getSavedAccount(): Account | null { try { const raw=localStorage.getItem('appointflow_user'); return raw ? JSON.parse(raw) as Account : null } catch { return null } }
export function saveSession(token:string,user:Account) { localStorage.setItem('appointflow_token',token); localStorage.setItem('appointflow_user',JSON.stringify(user)) }
export function clearSession() { localStorage.removeItem('appointflow_token'); localStorage.removeItem('appointflow_user') }
export async function api<T = any>(path:string, options:RequestInit = {}):Promise<T> {
  const token=getToken()
  const response=await fetch(`${API_URL}${path}`,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(options.headers||{})}})
  const data=await response.json().catch(()=>({error:'The server returned an invalid response.'}))
  if(!response.ok) { const err=new Error(data?.error || `Request failed (${response.status})`) as Error & {needsVerification?:boolean}; err.needsVerification=Boolean(data?.needsVerification); throw err }
  return data as T
}
