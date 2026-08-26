import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import Dashboard from "./components/Dashboard.jsx";
import MapView from "./components/MapView.jsx";
import StudentsPage from "./components/StudentsPage.jsx";
import EmployeesPage from "./components/EmployeesPage.jsx";
import SchoolsPage from "./components/SchoolsPage.jsx";
import DriversPage from "./components/DriversPage.jsx";
import BusesPage from "./components/BusesPage.jsx";
import AddRoutePage from "./components/AddRoutePage.jsx";
import AdmissionsPage from "./components/AdmissionsPage.jsx";
import FeePage from "./components/FeePage.jsx";
import AttendancePage from "./components/AttendancePage.jsx";
import ExaminationPage from "./components/ExaminationPage.jsx";
import FrontDeskPage from "./components/FrontDeskPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="topbar">
          <Link to="/" className="brand">
            <img src="/logo.png" alt="GodView logo" className="brand-logo" />
            <span>GodView</span>
          </Link>
          <Sidebar />
        </header>

        <div className="app-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/schools" element={<SchoolsPage />} />
            <Route path="/drivers" element={<DriversPage />} />
            <Route path="/buses" element={<BusesPage />} />
            <Route path="/transport" element={<MapView />} />
            <Route path="/add-route" element={<AddRoutePage />} />
            <Route path="/admissions" element={<AdmissionsPage />} />
            <Route path="/fee" element={<FeePage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/examination" element={<ExaminationPage />} />
            <Route path="/front-desk" element={<FrontDeskPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
