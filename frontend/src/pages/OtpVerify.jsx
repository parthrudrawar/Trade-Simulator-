import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

export default function OtpVerify() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!email) { navigate("/login"); return; }
    api.post("/auth/otp/generate", { email }).then(() => setSent(true)).catch(() => {});
  }, [email, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/auth/otp/verify", { email, otp });
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (user) { navigate("/dashboard"); return null; }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-gray-900 rounded-xl p-8 border border-gray-800">
        <h1 className="text-2xl font-bold text-emerald-400 text-center mb-6">TradeSimulator</h1>
        <h2 className="text-lg font-semibold mb-4">Verify OTP</h2>
        {sent && <div className="bg-emerald-900/50 text-emerald-300 text-sm p-3 rounded mb-4">OTP sent to {email}</div>}
        {error && <div className="bg-red-900/50 text-red-300 text-sm p-3 rounded mb-4">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">One-Time Password</label>
            <input type="text" value={otp} onChange={(e) => setOtp(e.target.value)} required maxLength={6} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-center text-lg tracking-widest" placeholder="000000" />
          </div>
          <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-2 rounded transition-colors">
            {submitting ? "Verifying..." : "Verify OTP"}
          </button>
        </form>
      </div>
    </div>
  );
}
