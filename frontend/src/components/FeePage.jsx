import React, { useState } from "react";
import DirectoryPage from "./DirectoryPage.jsx";
import Tabs from "./Tabs.jsx";
import { useCollectionIds, useRecords } from "./entityApi.jsx";

const TABS = [
  { key: "structure", label: "Fee Structure" },
  { key: "payments", label: "Payments" },
];

const FEE_TYPES = ["Tuition", "Transport", "Admission", "Exam", "Miscellaneous"];

export default function FeePage() {
  const [tab, setTab] = useState("structure");
  const schoolIds = useCollectionIds("schools");
  const students = useRecords("students");

  const studentOptions = (students || []).map((s) => ({
    value: s.id,
    label: `${s.name} · ${s.class}${s.section || ""} (${s.id})`,
  }));

  return (
    <div>
      <div className="module-tabs-bar">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "structure" ? (
        <DirectoryPage
          title="Fee Structure"
          singularLabel="Fee Line"
          collection="feeStructure"
          addEndpoint="/fee-structure/add"
          selectOptions={{ school_id: schoolIds, fee_type: FEE_TYPES }}
          summaryKeys={["class", "feeType", "amount"]}
          filterField="feeType"
          filterLabel="Fee Type"
          fields={[
            { name: "school_id", label: "School", type: "select", required: true },
            { name: "class", label: "Class", required: true, placeholder: "10" },
            { name: "fee_type", label: "Fee Type", type: "select", required: true },
            { name: "amount", label: "Amount", type: "number", required: true, placeholder: "5000" },
          ]}
          excel={{
            endpoint: "/upload/fee-structure",
            templateHint: "Columns: school_id, class, fee_type, amount",
            templateFile: "fee_structure_template.xlsx",
          }}
        />
      ) : (
        <DirectoryPage
          title="Fee Payments"
          singularLabel="Payment"
          collection="feePayments"
          addEndpoint="/fee-payments/add"
          selectOptions={{ student_id: studentOptions, fee_type: FEE_TYPES }}
          summaryKeys={["feeType", "amountPaid", "paymentDate", "mode"]}
          filterField="feeType"
          filterLabel="Fee Type"
          fields={[
            { name: "student_id", label: "Student", type: "select", required: true },
            { name: "fee_type", label: "Fee Type", type: "select", required: true },
            { name: "amount_paid", label: "Amount Paid", type: "number", required: true, placeholder: "5000" },
            { name: "payment_date", label: "Payment Date", required: true, placeholder: "2026-08-12" },
            { name: "mode", label: "Mode", placeholder: "Cash / UPI / Cheque" },
            { name: "remarks", label: "Remarks", placeholder: "Term 1 fee" },
          ]}
          excel={{
            endpoint: "/upload/fee-payments",
            templateHint: "Columns: student_id, fee_type (Tuition/Transport/...), amount_paid, payment_date, mode, remarks",
            templateFile: "fee_payments_template.xlsx",
          }}
        />
      )}
    </div>
  );
}
