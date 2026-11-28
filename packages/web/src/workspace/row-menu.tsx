import { Button } from "@ui-sdk/react/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { Icon } from "../components/icon";

export interface RowMenuItem {
  readonly value: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}

interface RowMenuProps {
  readonly label: string;
  readonly items: readonly RowMenuItem[];
  readonly onAction: (value: string) => void;
}

export function RowMenu({ label, items, onAction }: RowMenuProps) {
  return (
    <Menu onAction={(value) => onAction(value)}>
      <MenuTrigger
        render={
          <Button data-variant="ghost" className="wp-more" aria-label={`Actions for ${label}`} />
        }
      >
        <Icon name="more" />
      </MenuTrigger>
      <MenuContent>
        {items.map((item) => (
          <MenuItem
            key={item.value}
            value={item.value}
            disabled={item.disabled ?? false}
            destructive={item.destructive ?? false}
          >
            {item.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
