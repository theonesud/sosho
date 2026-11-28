import { FormChoiceFields } from "./form-choice-fields";
import { FormTextFields } from "./form-text-fields";
import { ShowcaseSection } from "./showcase-section";

export function FormsSection() {
  return (
    <ShowcaseSection
      id="forms"
      title="Form controls"
      description="Every control sits in a Field with a label, a hint, and an error state."
    >
      <div className="card panel">
        <FormTextFields />
      </div>
      <div className="card panel">
        <FormChoiceFields />
      </div>
    </ShowcaseSection>
  );
}
