/**
 * Workflow to implement, review, and test a frontend component using the Principal Frontend Engineer.
 */
export default async function frontendTask(claude, taskDescription) {
  console.log(`Starting Frontend Task Workflow: ${taskDescription}`);

  // Step 1: Implement the Component
  const implementResult = await claude.runAgent('frontend-engineer', `
    Task: ${taskDescription}
    Please implement the requested frontend component or feature.
    Focus on semantic HTML, proper state management, and strict TypeScript types.
  `);

  if (implementResult.error) {
    console.error("Implementation failed:", implementResult.error);
    return;
  }
  console.log("Implementation completed.");

  // Step 2: Component Review
  console.log("Running component architectural review...");
  const filesChanged = implementResult.filesChanged || [];
  const componentFiles = filesChanged.filter(f => f.endsWith('.tsx') || f.endsWith('.jsx'));
  
  if (componentFiles.length > 0) {
    for (const file of componentFiles) {
      await claude.runSkill('component-review', file);
    }
    console.log("Component review completed.");
  }

  // Step 3: Accessibility Audit
  console.log("Running accessibility audit...");
  if (componentFiles.length > 0) {
    for (const file of componentFiles) {
      await claude.runSkill('a11y-audit', file);
    }
    console.log("A11y audit completed.");
  }

  // Step 4: Run Tests
  console.log("Running frontend tests...");
  await claude.runSkill('frontend-test', '');
  
  console.log("Frontend task fully completed and verified.");
}
