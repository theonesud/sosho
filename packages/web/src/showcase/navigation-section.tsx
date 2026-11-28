import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@ui-sdk/react/accordion";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { Tree, TreeGroup, TreeItem, TreeItemIndicator, TreeItemLabel } from "@ui-sdk/react/tree";
import { versionTree } from "./mock";
import { ShowcaseSection } from "./showcase-section";

const settings = [
  {
    value: "retries",
    title: "Retries",
    body: "Failed nodes retry up to three times with backoff.",
  },
  {
    value: "timeout",
    title: "Timeouts",
    body: "A human node waits 24 hours before the run fails.",
  },
  { value: "storage", title: "Storage", body: "Node input and output stay for 30 days." },
];

export function NavigationSection() {
  return (
    <ShowcaseSection
      id="navigation"
      title="Tabs, accordion, and versions"
      description="Structure for the run view, settings, and the version history."
    >
      <div className="grid-2">
        <div className="card panel">
          <Tabs defaultValue="input">
            <TabsList aria-label="Node data">
              <TabsTab value="input">Input</TabsTab>
              <TabsTab value="output">Output</TabsTab>
              <TabsTab value="logs">Logs</TabsTab>
              <TabsIndicator />
            </TabsList>
            <TabsPanel value="input">Documents and options passed to the node.</TabsPanel>
            <TabsPanel value="output">Summary text and score from the node.</TabsPanel>
            <TabsPanel value="logs">Model calls and tool results.</TabsPanel>
          </Tabs>
        </div>
        <div className="card panel">
          <Tree aria-label="Version history" defaultExpanded={["v12"]}>
            {versionTree.map((version) => (
              <TreeItem key={version.value} value={version.value}>
                <TreeItemLabel>
                  {version.children ? <TreeItemIndicator /> : null}
                  {version.label}
                </TreeItemLabel>
                {version.children ? (
                  <TreeGroup>
                    {version.children.map((child) => (
                      <TreeItem key={child.value} value={child.value}>
                        <TreeItemLabel>{child.label}</TreeItemLabel>
                      </TreeItem>
                    ))}
                  </TreeGroup>
                ) : null}
              </TreeItem>
            ))}
          </Tree>
        </div>
      </div>
      <Accordion defaultValue={["retries"]}>
        {settings.map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionHeader>
              <AccordionTrigger>{item.title}</AccordionTrigger>
            </AccordionHeader>
            <AccordionPanel>{item.body}</AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </ShowcaseSection>
  );
}
