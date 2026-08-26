import React from "react";
import { Link } from "react-router-dom";
import DirectoryPage from "./DirectoryPage.jsx";
import EmployeeProfile from "./EmployeeProfile.jsx";
import { useCollectionIds } from "./entityApi.jsx";

export default function EmployeesPage() {
  const schoolIds = useCollectionIds("schools");

  return (
    <DirectoryPage
      title="Employees"
      singularLabel="Employee"
      collection="employees"
      addEndpoint="/employees/add"
      selectOptions={{ school_id: schoolIds, staff_type: ["Teaching", "Non-Teaching"] }}
      summaryKeys={["staffType", "designation", "department"]}
      filterField="staffType"
      filterLabel="Staff Type"
      renderDetail={(employee) => <EmployeeProfile employee={employee} />}
      addPanelFooter={
        <Link to="/schools" className="directory-footer-link">
          Manage schools →
        </Link>
      }
      fields={[
        { name: "name", label: "Name", required: true, placeholder: "Meena Gupta" },
        { name: "school_id", label: "School", type: "select", required: true },
        { name: "staff_type", label: "Staff Type", type: "select", required: true },
        { name: "designation", label: "Designation", placeholder: "Teacher" },
        { name: "department", label: "Department", placeholder: "Mathematics" },
        { name: "phone", label: "Phone", placeholder: "9876500003" },
        { name: "email", label: "Email", placeholder: "meena@example.com" },
        { name: "joining_date", label: "Joining Date", placeholder: "2020-06-01" },
      ]}
      excel={{
        endpoint: "/upload/employees",
        templateHint:
          "Columns: name, school_id, staff_type (Teaching/Non-Teaching), designation, department, phone, email, joining_date (employee_id is assigned automatically)",
        templateFile: "employees_template.xlsx",
      }}
    />
  );
}
