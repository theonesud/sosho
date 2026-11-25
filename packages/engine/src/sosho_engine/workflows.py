from sosho_engine.nodeflow import node_workflow
from sosho_engine.runflow import run_workflow, scheduled_run

REGISTERED = (run_workflow, node_workflow, scheduled_run)
