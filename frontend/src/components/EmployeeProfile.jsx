import React from "react";
import { useRecords, FieldList } from "./entityApi.jsx";
import ProfileSection from "./ProfileSection.jsx";

// The Employee detail modal's body: pulls in staff attendance and leave
// records for this employee, plus the routes at their school.
export default function EmployeeProfile({ employee }) {
  const staffAttendance = useRecords("staffAttendance");
  const leaves = useRecords("leaves");
  const routes = useRecords("routes");

  const attendanceRows = [];
  (staffAttendance || []).forEach((doc) => {
    (doc.records || []).forEach((r) => {
      if (r.employeeId === employee.id) {
        attendanceRows.push({ date: doc.date, status: r.status });
      }
    });
  });
  attendanceRows.sort((a, b) => (a.date < b.date ? 1 : -1));

  const leaveRows = (leaves || []).filter((l) => l.employeeId === employee.id);
  const schoolRoutes = (routes || []).filter((r) => r.schoolId === employee.schoolId);

  return (
    <div className="profile-sections">
      <ProfileSection title="Overview">
        <FieldList item={employee} exclude={["name", "id"]} />
      </ProfileSection>

      <ProfileSection title="Staff Attendance">
        {staffAttendance === null ? (
          <p className="hint">Loading...</p>
        ) : attendanceRows.length === 0 ? (
          <p className="hint">No attendance marked yet.</p>
        ) : (
          <ul className="profile-list">
            {attendanceRows.slice(0, 10).map((r, i) => (
              <li key={i}>
                {r.date} ·{" "}
                <span className={r.status === "Present" ? "tag-present" : "tag-absent"}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <ProfileSection title="Leaves">
        {leaves === null ? (
          <p className="hint">Loading...</p>
        ) : leaveRows.length === 0 ? (
          <p className="hint">No leave requests yet.</p>
        ) : (
          <ul className="profile-list">
            {leaveRows.map((l) => (
              <li key={l.id}>
                {l.fromDate} → {l.toDate} · {l.status}
                {l.reason ? ` · ${l.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <ProfileSection title="Transport">
        {routes === null ? (
          <p className="hint">Loading...</p>
        ) : schoolRoutes.length === 0 ? (
          <p className="hint">No routes set up for this employee's school yet.</p>
        ) : (
          <ul className="profile-list">
            {schoolRoutes.map((r) => (
              <li key={r.id}>
                Route {r.routeId} · Bus {r.busId} · {(r.stops || []).length} stops
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>
    </div>
  );
}
