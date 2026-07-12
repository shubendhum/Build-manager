import { useState } from "react";
import { EstimatorSection } from "@/components/EstimatorSection";
import { BudgetSection } from "@/components/BudgetSection";

export const BudgetTab = ({ project }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div data-testid="budget-tab">
      <EstimatorSection project={project} onChanged={() => setRefreshKey((k) => k + 1)} />
      <BudgetSection projectId={project.id} refreshKey={refreshKey} />
    </div>
  );
};
