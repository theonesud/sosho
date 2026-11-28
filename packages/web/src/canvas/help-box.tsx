import { Button } from "@ui-sdk/react/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover";
import { helpRows } from "./help-rows";
import { isMacPlatform, keyParts } from "./key-label";

function Keys({ keys, mac }: { readonly keys: string; readonly mac: boolean }) {
  return (
    <span className="cv-help-keys">
      {keyParts(keys, mac).map((part) => (
        <kbd key={part}>{part}</kbd>
      ))}
    </span>
  );
}

export function HelpBox({ runMode }: { readonly runMode: boolean }) {
  const mac = isMacPlatform();
  return (
    <div className="cv-help" data-no-pan>
      <Popover>
        <PopoverTrigger
          render={
            <Button data-variant="ghost" className="cv-help-trigger" aria-label="Shortcuts" />
          }
        >
          Shortcuts
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={8} className="cv-help-pop">
          <PopoverTitle>Shortcuts</PopoverTitle>
          <dl className="cv-help-list">
            {helpRows(runMode).map((row) => (
              <div key={row.action} className="cv-help-row">
                <dt>{row.action}</dt>
                <dd>
                  {row.keys.map((keys) => (
                    <Keys key={keys} keys={keys} mac={mac} />
                  ))}
                  {row.text ? <span className="cv-help-text">{row.text}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  );
}
