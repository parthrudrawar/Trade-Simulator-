import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { ToastProvider } from "./context/ToastContext";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import OtpVerify from "./pages/OtpVerify";
import Dashboard from "./pages/Dashboard";
import Trading from "./pages/Trading";
import Portfolio from "./pages/Portfolio";
import Watchlists from "./pages/Watchlists";
import TradeHistory from "./pages/TradeHistory";
import Alerts from "./pages/Alerts";
import AssetDetail from "./pages/AssetDetail";

export default function App() {
  return (
    <ToastProvider>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/otp" element={<OtpVerify />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/trading" element={<Trading />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/watchlists" element={<Watchlists />} />
        <Route path="/history" element={<TradeHistory />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/asset/:assetType/:symbol" element={<AssetDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ToastProvider>
  );
}
