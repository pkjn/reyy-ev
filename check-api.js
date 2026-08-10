const baseUrl = "http://localhost:3000";
const customerId = "29eca681-c2d0-4217-8222-af60dce54eb3"; 

async function run() {
  const adminRes = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ password: "dev123" }) // from .env.local
  });
  const cookieHeader = adminRes.headers.get("set-cookie");
  const adminCookie = cookieHeader ? cookieHeader.split(";")[0] : "";

  let cRes = await fetch(`${baseUrl}/api/customers/${customerId}`, {
    headers: { "Cookie": adminCookie }
  });
  let cData = await cRes.json();
  console.log(JSON.stringify(cData, null, 2));
}

run();
