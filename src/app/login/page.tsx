"use client";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="card w-full max-w-sm p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
          if (r.ok) location.href = "/";
          else setErr("Wrong password");
        }}
      >
        <div className="mb-4 text-lg font-semibold">Aangan front desk</div>
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <div className="mt-2 text-sm text-bad">{err}</div>}
        <button className="btn btn-primary mt-4 w-full justify-center">Sign in</button>
      </form>
    </main>
  );
}
