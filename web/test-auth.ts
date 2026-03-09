async function run() {
    const loginRes = await fetch("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@hippocampus.app", password: "admin123" })
    });
    const headers = loginRes.headers;
    const cookies = headers.get("set-cookie") || "";
    const jwtCookie = Array.isArray(cookies) ? cookies.find(c => c.includes("access_token")) : cookies;
    if(!jwtCookie) {
        console.log("Failed to login", await loginRes.text());
        return;
    }
    const token = jwtCookie.split(";")[0].split("=")[1];

    const tagsRes = await fetch("http://localhost:3000/api/admin/tags", {
        headers: { "Cookie": `access_token=${token}` }
    });
    console.log("Tags Res Status:", tagsRes.status);
    console.log("Tags Res Text:", await tagsRes.text());
}
run();
