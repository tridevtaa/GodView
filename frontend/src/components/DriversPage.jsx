import React from "react";
import DirectoryPage from "./DirectoryPage.jsx";

export default function DriversPage() {
  return (
    <DirectoryPage
      title="Drivers"
      singularLabel="Driver"
      collection="drivers"
      addEndpoint="/drivers/add"
      summaryKeys={["phone"]}
      fields={[
        { name: "name", label: "Name", required: true, placeholder: "Suresh Yadav" },
        { name: "phone", label: "Phone", placeholder: "9876500005" },
      ]}
      excel={{
        endpoint: "/upload/drivers",
        templateHint: "Columns: name, phone (driver_id is assigned automatically)",
        templateFile: "drivers_template.xlsx",
      }}
    />
  );
}
