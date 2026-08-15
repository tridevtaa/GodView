import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";
import {
  AttendanceIcon,
  TimetableIcon,
  ExaminationIcon,
  RouteIcon,
  EmployeesIcon,
  FeeIcon,
  AdmissionIcon,
  UploadIcon,
  StudentIcon,
  TransportIcon,
  VisitorIcon,
  GatePassIcon,
} from "./icons.jsx";

const QUICK_ACTION_GROUPS = [
  {
    title: "Academic",
    color: "#2563eb",
    items: [
      { to: "/upload/students", label: "Add Student", icon: StudentIcon },
      { to: "/timetable/build", label: "Build Timetable", icon: TimetableIcon },
      { to: "/exams/marks-entry", label: "Marks Entry", icon: ExaminationIcon },
    ],
  },
  {
    title: "Fee",
    color: "#16a34a",
    items: [
      { to: "/upload/feePayments", label: "Fee Payment", icon: FeeIcon },
      { to: "/upload/feeStructure", label: "Fee Structure", icon: FeeIcon },
    ],
  },
  {
    title: "HR & Front Desk",
    color: "#db2777",
    items: [
      { to: "/employees/attendance", label: "Staff Attendance", icon: AttendanceIcon },
      { to: "/upload/admissions", label: "New Admission", icon: AdmissionIcon },
      { to: "/upload/visitors", label: "Visitor Log", icon: VisitorIcon },
      { to: "/upload/enquiries", label: "Enquiries", icon: AdmissionIcon },
      { to: "/upload/gatePasses", label: "Gate Pass", icon: GatePassIcon },
    ],
  },
  {
    title: "Transport",
    color: "#ea580c",
    items: [
      { to: "/add-route", label: "Add Route", icon: RouteIcon },
      { to: "/transport", label: "Transport Map", icon: TransportIcon },
    ],
  },
];

function useCount(collectionName, filterFn) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, collectionName))
      .then((snap) => {
        if (cancelled) return;
        const docs = snap.docs.map((d) => d.data());
        setCount(filterFn ? docs.filter(filterFn).length : docs.length);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionName]);
  return count;
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="stat-card">
      <span className="stat-card-icon">
        <Icon />
      </span>
      <div>
        <div className="stat-card-value">{value === null ? "…" : value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const schoolCount = useCount("schools");
  const studentCount = useCount("students");
  const employeeCount = useCount("employees");
  const pendingAdmissions = useCount("admissions", (a) => a.status !== "Admitted");

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>Welcome to GodView</h1>
        <p>Manage your school, one module at a time.</p>
      </div>

      <div className="stat-row">
        <StatCard label="Schools" value={schoolCount} icon={RouteIcon} />
        <StatCard label="Students" value={studentCount} icon={StudentIcon} />
        <StatCard label="Employees" value={employeeCount} icon={EmployeesIcon} />
        <StatCard label="Pending Admissions" value={pendingAdmissions} icon={AdmissionIcon} />
      </div>

      {QUICK_ACTION_GROUPS.map((group) => (
        <div key={group.title} className="quick-actions-group">
          <h2 className="dashboard-section-title">{group.title}</h2>
          <div className="quick-actions">
            {group.items.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="quick-action-card">
                <span className="quick-action-icon" style={{ color: group.color }}>
                  <Icon />
                </span>
                <span className="quick-action-label">{label}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <Link to="/upload" className="dashboard-all-data-link">
        <UploadIcon />
        Browse all data in Upload Data →
      </Link>
    </div>
  );
}
