import { Button } from "@ui-sdk/react/button";
import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationList,
  PaginationNext,
  PaginationPrevious,
} from "@ui-sdk/react/pagination";
import { useState } from "react";
import { EmptyState } from "../components/empty-state";
import { Icon } from "../components/icon";
import { RunsTable, type SortDirection } from "../components/runs-table";
import { runRows } from "./mock";
import { ShowcaseSection } from "./showcase-section";

type TableState = "data" | "loading" | "empty";

export function TableSection() {
  const [direction, setDirection] = useState<SortDirection>("descending");
  const [state, setState] = useState<TableState>("data");
  const [page, setPage] = useState(1);
  const rows = direction === "descending" ? runRows : [...runRows].reverse();

  return (
    <ShowcaseSection
      id="table"
      title="Runs"
      description="A native table with sort, row menu, pagination, and loading and empty states."
    >
      <div className="row">
        <Button data-variant="secondary" onClick={() => setState("data")}>
          Data
        </Button>
        <Button data-variant="secondary" onClick={() => setState("loading")}>
          Loading
        </Button>
        <Button data-variant="secondary" onClick={() => setState("empty")}>
          Empty
        </Button>
      </div>
      {state === "empty" ? (
        <EmptyState
          icon="run"
          title="No runs yet"
          action={
            <Button data-variant="primary">
              <Icon name="run" />
              Run a workflow
            </Button>
          }
        >
          Runs appear here after a trigger fires or you start one by hand.
        </EmptyState>
      ) : (
        <RunsTable
          rows={rows}
          loading={state === "loading"}
          direction={direction}
          page={page}
          onToggleSort={() => setDirection((d) => (d === "ascending" ? "descending" : "ascending"))}
        />
      )}
      <RunsPagination page={page} onPageChange={setPage} />
    </ShowcaseSection>
  );
}

interface RunsPaginationProps {
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}

function RunsPagination({ page, onPageChange }: RunsPaginationProps) {
  return (
    <Pagination aria-label="Runs pages" pageCount={12} page={page} onPageChange={onPageChange}>
      <PaginationList>
        {({ items }) => (
          <>
            <PaginationItem>
              <PaginationPrevious aria-label="Previous page" />
            </PaginationItem>
            {items.map((item, index) => (
              <PaginationItem key={typeof item === "number" ? item : `gap-${index}`}>
                {typeof item === "number" ? <PaginationLink page={item} /> : <PaginationEllipsis />}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext aria-label="Next page" />
            </PaginationItem>
          </>
        )}
      </PaginationList>
    </Pagination>
  );
}
