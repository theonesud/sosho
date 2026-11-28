import { OverlayHost } from "@ui-sdk/react/overlays";
import { AppShell } from "../components/app-shell";
import { BadgesSection } from "./badges-section";
import { ButtonsSection } from "./buttons-section";
import { CanvasSection } from "./canvas-section";
import { CardsSection } from "./cards-section";
import { FeedbackSection } from "./feedback-section";
import { FormsSection } from "./forms-section";
import { InboxSection } from "./inbox-section";
import { NavigationSection } from "./navigation-section";
import { OverlaysSection } from "./overlays-section";
import { RunSection } from "./run-section";
import { TableSection } from "./table-section";
import { TriggersSection } from "./triggers-section";

export function DesignRefPage() {
  return (
    <AppShell>
      <header className="page-head">
        <h1>Sosho</h1>
        <p className="muted">Every component the screens need, on static mock data.</p>
      </header>
      <CanvasSection />
      <RunSection />
      <TableSection />
      <CardsSection />
      <InboxSection />
      <TriggersSection />
      <NavigationSection />
      <OverlaysSection />
      <ButtonsSection />
      <FormsSection />
      <BadgesSection />
      <FeedbackSection />
      <OverlayHost />
    </AppShell>
  );
}
