const baseUrl = "http://localhost:3000";
const customerId = "c-prateek"; 

async function test() {
  console.log(`Starting test for customer: ${customerId}`);
  
  // 0. Admin Login
  console.log("\n[0] Logging in as Admin...");
  const adminRes = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ password: "dev123" }) // from .env.local
  });
  if (!adminRes.ok) throw new Error("Admin login failed");
  const cookieHeader = adminRes.headers.get("set-cookie");
  const adminCookie = cookieHeader ? cookieHeader.split(";")[0] : "";
  console.log("Admin cookie obtained.");

  // 1. Get customer details to verify
  console.log("\n[1] Fetching customer details...");
  let cRes = await fetch(`${baseUrl}/api/customers/${customerId}`, {
    headers: { "Cookie": adminCookie }
  });
  if (!cRes.ok) {
    const txt = await cRes.text();
    throw new Error("Failed to fetch customer: " + cRes.status + " " + txt.substring(0, 50));
  }
  let cData = await cRes.json();
  
  const phone = cData.phones && cData.phones[0];
  if (!phone) throw new Error("Customer has no phone number");
  console.log("Customer phone:", phone);

  // 2. Generate password
  console.log("\n[2] Generating driver password (simulating Admin)...");
  const pRes = await fetch(`${baseUrl}/api/admin/customers/${customerId}/set-driver-password`, {
    method: "POST", 
    headers: {
      "Content-Type": "application/json",
      "Cookie": adminCookie
    },
    body: JSON.stringify({ generate: true })
  });
  const pData = await pRes.json();
  const password = pData.password;
  console.log("Password generated:", password);

  // 3. Login
  console.log("\n[3] Logging into driver API (simulating Expo app)...");
  const lRes = await fetch(`${baseUrl}/api/driver/login`, {
    method: "POST", 
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ phone, password })
  });
  const lData = await lRes.json();
  if (!lRes.ok) throw new Error("Login failed: " + JSON.stringify(lData));
  const token = lData.token;
  console.log("Login token received:", !!token);

  // 4. Send location
  console.log("\n[4] Pushing background location ping...");
  const locRes = await fetch(`${baseUrl}/api/driver/location`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": `Bearer ${token}`},
    body: JSON.stringify({
      lat: 28.7041,
      lng: 77.1025,
      battery: 88,
      captured_at: new Date().toISOString()
    })
  });
  if (!locRes.ok) {
    const err = await locRes.text();
    console.log("Location ping failed:", locRes.status, err);
  } else {
    console.log("Location ping successful (Status 200)");
  }

  // 5. Verify location on customer profile
  console.log("\n[5] Verifying live tracker on Dashboard API...");
  cRes = await fetch(`${baseUrl}/api/customers/${customerId}`, {
    headers: { "Cookie": adminCookie }
  });
  cData = await cRes.json();
  console.log("Live tracker data:", cData.live_tracker);
  
  console.log("\nAll tests completed!");
}

test().catch(console.error);
