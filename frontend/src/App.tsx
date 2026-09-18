import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Header, Footer } from "./components/Header";
import { Dashboard } from "./pages/Dashboard";
import { StationDetail } from "./pages/StationDetail";
import { Alerts } from "./pages/Alerts";
import { AuthorityLogin } from "./pages/AuthorityLogin";
import { AuthorityConsole } from "./pages/AuthorityConsole";
import { PublicView } from "./pages/PublicView";
import { UnsubscribePage } from "./pages/UnsubscribePage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/public" element={<PublicView />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route path="/station/:id" element={<StationDetail />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/auth/login" element={<AuthorityLogin />} />
            <Route path="/authority" element={<AuthorityConsole />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}