import React from "react";
import { useRecords, FieldList } from "./entityApi.jsx";
import ProfileSection from "./ProfileSection.jsx";

// The Student detail modal's "360°" body: pulls in every other collection
// that references this student (admission, fee, attendance, exam results,
// gate passes) plus the routes at their school, and shows them alongside
// the student's own fields.
export default function StudentProfile({ student }) {
  const admissions = useRecords("admissions");
  const feePayments = useRecords("feePayments");
  const attendance = useRecords("attendance");
  const exams = useRecords("exams");
  const results = useRecords("results");
  const gatePasses = useRecords("gatePasses");
  const routes = useRecords("routes");

  const admission = (admissions || []).find((a) => a.id === student.admissionId) || null;

  const payments = (feePayments || []).filter((p) => p.studentId === student.id);

  const attendanceRows = [];
  (attendance || []).forEach((doc) => {
    (doc.records || []).forEach((r) => {
      if (r.studentId === student.id) {
        attendanceRows.push({ date: doc.date, status: r.status });
      }
    });
  });
  attendanceRows.sort((a, b) => (a.date < b.date ? 1 : -1));

  const examMap = Object.fromEntries((exams || []).map((e) => [e.id, e]));
  const resultRows = [];
  (results || []).forEach((doc) => {
    (doc.entries || []).forEach((e) => {
      if (e.studentId === student.id) {
        const exam = examMap[doc.examId];
        resultRows.push({
          exam: exam?.name || doc.examId,
          subject: e.subject,
          marksObtained: e.marksObtained,
          maxMarks: e.maxMarks,
        });
      }
    });
  });

  const passes = (gatePasses || []).filter((g) => g.studentId === student.id);
  const assignedRoute = (routes || []).find((r) => r.id === student.routeId) || null;
  const schoolRoutes = (routes || []).filter((r) => r.schoolId === student.schoolId);

  return (
    <div className="profile-sections">
      <ProfileSection title="Overview">
        <FieldList
          item={student}
          exclude={["name", "id", "admissionId", "routeId", "stopName"]}
        />
      </ProfileSection>

      <ProfileSection title="Admission">
        {admissions === null ? (
          <p className="hint">Loading...</p>
        ) : admission ? (
          <ul className="profile-list">
            <li>Status: {admission.status}</li>
            <li>Admission No.: {admission.admissionNo || "—"}</li>
            <li>
              Parent: {admission.parentName || "—"} ({admission.parentPhone || "—"})
            </li>
          </ul>
        ) : (
          <p className="hint">
            No linked admission record
            {student.admissionNo ? ` (Admission No. ${student.admissionNo})` : ""}.
          </p>
        )}
      </ProfileSection>

      <ProfileSection title="Fee">
        {feePayments === null ? (
          <p className="hint">Loading...</p>
        ) : payments.length === 0 ? (
          <p className="hint">No fee payments recorded.</p>
        ) : (
          <ul className="profile-list">
            {payments.map((p) => (
              <li key={p.id}>
                {p.feeType ? `${p.feeType} · ` : ""}₹{p.amountPaid} · {p.paymentDate} · {p.mode || "—"}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <ProfileSection title="Attendance">
        {attendance === null ? (
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

      <ProfileSection title="Examination">
        {results === null ? (
          <p className="hint">Loading...</p>
        ) : resultRows.length === 0 ? (
          <p className="hint">No exam results yet.</p>
        ) : (
          <ul className="profile-list">
            {resultRows.map((r, i) => (
              <li key={i}>
                {r.exam} · {r.subject}: {r.marksObtained}/{r.maxMarks}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <ProfileSection title="Front Desk">
        {gatePasses === null ? (
          <p className="hint">Loading...</p>
        ) : passes.length === 0 ? (
          <p className="hint">No gate passes issued.</p>
        ) : (
          <ul className="profile-list">
            {passes.map((p) => (
              <li key={p.id}>
                {p.date} · {p.reason}
                {p.timeOut ? ` at ${p.timeOut}` : ""}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>

      <ProfileSection title="Transport">
        {routes === null ? (
          <p className="hint">Loading...</p>
        ) : student.stopName || assignedRoute ? (
          <ul className="profile-list">
            {student.stopName && <li>Stop: {student.stopName}</li>}
            {assignedRoute && (
              <li>
                Route {assignedRoute.routeId} · Bus {assignedRoute.busId}
              </li>
            )}
          </ul>
        ) : (
          <p className="hint">No transport assignment set for this student.</p>
        )}

        {!assignedRoute && schoolRoutes.length > 0 && (
          <>
            <p className="hint profile-subhint">Routes available at this school:</p>
            <ul className="profile-list">
              {schoolRoutes.map((r) => (
                <li key={r.id}>
                  Route {r.routeId} · Bus {r.busId} · {(r.stops || []).length} stops
                </li>
              ))}
            </ul>
          </>
        )}
      </ProfileSection>
    </div>
  );
}
