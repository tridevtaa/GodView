import React from "react";
import { Link } from "react-router-dom";
import DirectoryPage from "./DirectoryPage.jsx";
import { useCollectionIds } from "./entityApi.jsx";

export default function BusesPage() {
  const driverIds = useCollectionIds("drivers");

  return (
    <DirectoryPage
      title="Buses"
      singularLabel="Bus"
      collection="buses"
      addEndpoint="/buses/add"
      selectOptions={{ driver_id: driverIds }}
      summaryKeys={["busNumber", "driverId", "capacity"]}
      addPanelFooter={
        <Link to="/drivers" className="directory-footer-link">
          Manage drivers →
        </Link>
      }
      fields={[
        { name: "bus_number", label: "Bus Number", required: true, placeholder: "HR-26-AB-1234" },
        { name: "driver_id", label: "Driver", type: "select" },
        { name: "capacity", label: "Capacity", type: "number", placeholder: "40" },
      ]}
      excel={{
        endpoint: "/upload/buses",
        templateHint:
          "Columns: bus_number, driver_id (optional, must already exist), capacity (optional; bus_id is assigned automatically)",
        templateFile: "buses_template.xlsx",
      }}
    />
  );
}
