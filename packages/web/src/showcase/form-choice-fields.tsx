import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@ui-sdk/react/combobox";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import { Label } from "@ui-sdk/react/label";
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input";
import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from "@ui-sdk/react/slider";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";

const models = ["local-uncensored", "decision", "embed"];

export function FormChoiceFields() {
  return (
    <div className="form-grid">
      <PickerFields />
      <ToggleFields />
    </div>
  );
}

function PickerFields() {
  return (
    <>
      <Field name="kind">
        <FieldLabel>Node kind</FieldLabel>
        <Select defaultValue="llm">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="llm">LLM</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="tool">Tool</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="field-stack">
        <Combobox name="model" defaultValue="local-uncensored">
          <ComboboxLabel>Model role</ComboboxLabel>
          <ComboboxInput placeholder="Search roles" />
          <ComboboxContent>
            <ComboboxList>
              {models.map((model) => (
                <ComboboxItem key={model} value={model}>
                  {model}
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      <Field name="retries">
        <FieldLabel>Max retries</FieldLabel>
        <NumberInput defaultValue={3} min={0} max={10}>
          <NumberInputGroup>
            <NumberInputDecrement aria-label="Decrease retries" />
            <NumberInputControl />
            <NumberInputIncrement aria-label="Increase retries" />
          </NumberInputGroup>
        </NumberInput>
        <FieldDescription>Between 0 and 10.</FieldDescription>
      </Field>
    </>
  );
}

function ToggleFields() {
  return (
    <>
      <Slider defaultValue={80} min={0} max={100} className="field-stack">
        <div className="row between">
          <span className="field-title">Quality threshold</span>
          <SliderValue />
        </div>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-label="Quality threshold" />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <Field name="mode">
        <FieldLabel>Failure mode</FieldLabel>
        <RadioGroup defaultValue="stop">
          <Label className="inline-label">
            <Radio value="stop">
              <RadioIndicator />
            </Radio>
            Stop the run
          </Label>
          <Label className="inline-label">
            <Radio value="continue">
              <RadioIndicator />
            </Radio>
            Continue
          </Label>
        </RadioGroup>
      </Field>
      <div className="stack">
        <Label className="inline-label">
          <Switch defaultChecked>
            <SwitchThumb />
          </Switch>
          Stream events
        </Label>
        <Label className="inline-label">
          <Checkbox defaultChecked>
            <CheckboxIndicator />
          </Checkbox>
          Save node output
        </Label>
      </div>
    </>
  );
}
