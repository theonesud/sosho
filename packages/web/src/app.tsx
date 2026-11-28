import { Workspace } from "./canvas/workspace";
import { useRoute } from "./route";
import { DesignRefPage } from "./showcase/design-ref-page";

export function App() {
  const route = useRoute();
  if (route.kind === "design-ref") {
    return <DesignRefPage />;
  }
  return <Workspace />;
}
