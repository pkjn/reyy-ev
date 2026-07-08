const baseUrl = "http://localhost:3000";
const customerId = "29eca681-c2d0-4217-8222-af60dce54eb3"; 

async function getUrl() {
  const adminRes = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ password: "dev123" }) // from .env.local
  });
  if (!adminRes.ok) throw new Error("Admin login failed");
  const cookieHeader = adminRes.headers.get("set-cookie");
  const adminCookie = cookieHeader ? cookieHeader.split(";")[0] : "";

  let cRes = await fetch(`${baseUrl}/api/customers/${customerId}`, {
    headers: { "Cookie": adminCookie }
  });
  let cData = await cRes.json();
  const phone = cData.phones && cData.phones[0];

  const pRes = await fetch(`${baseUrl}/api/admin/customers/${customerId}/set-driver-password`, {
    method: "POST", 
    headers: { "Content-Type": "application/json", "Cookie": adminCookie },
    body: JSON.stringify({ generate: true })
  });
  const password = (await pRes.json()).password;

  const lRes = await fetch(`${baseUrl}/api/driver/login`, {
    method: "POST", 
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ phone, password })
  });
  const token = (await lRes.json()).token;

  console.log(`\nHere is your Magic Link:`);
  console.log(`${baseUrl}/driver/auth?token=${token}\n`);
}

getUrl().catch(console.error);
