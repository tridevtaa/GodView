import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import Dashboard from "./components/Dashboard.jsx";
import MapView from "./components/MapView.jsx";
import UploadPage from "./components/UploadPage.jsx";
import AddRoutePage from "./components/AddRoutePage.jsx";
import AttendancePage from "./components/AttendancePage.jsx";
import TimetablePage from "./components/TimetablePage.jsx";
import MarksEntryPage from "./components/MarksEntryPage.jsx";
import EmployeeAttendancePage from "./components/EmployeeAttendancePage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <header className="topbar">
            <Link to="/" className="brand">
              <img src="/logo.png" alt="GodView logo" className="brand-logo" />
              <span>
                GodView
                <small>Fleet Intelligence</small>
              </span>
            </Link>
          </header>

          <div className="app-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transport" element={<MapView />} />
              <Route path="/add-route" element={<AddRoutePage />} />
              <Route path="/attendance/mark" element={<AttendancePage />} />
              <Route path="/timetable/build" element={<TimetablePage />} />
              <Route path="/exams/marks-entry" element={<MarksEntryPage />} />
              <Route path="/employees/attendance" element={<EmployeeAttendancePage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/upload/:tab" element={<UploadPage />} />
            </Routes>
          </div>
        </div>
      </div>
    </BrowserRouter>
  );
}
