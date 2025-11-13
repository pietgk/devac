# efficient validation

## ideas prompt to determine how to do efficient validation of the complete code base while developing

can you do a very thorough check if the devac-test database filled by the codegrapg analyzer is complete and correct and i would like to know what its quality for analysing all the repos code in ~/ws is.

next i want to determine how the get the most out of the combination of
- complete graph (from ast) in devac-test
- we did an initial version to determine how to run the typecheck, lint, tests in/on repos and packages
- we need to deteermine when to run the typecheck, lint and tests

to do that we need to determine what the dependancies for running the commands by the specific services instances are.
it feels that analysing how and the dependancies that triger when should be part of the graph so we have the dependancies as part of the knowledge and we can use that to determine the dependancy graph that will trigger a service command when 1 or more of the dependacies change.

can we have a thorough anaysis on how we should tackle this.

the goal is to run only typescript, lint and tests when needed. we can run them all to get fully in sync but running the specific typechecks, lint and test at file, package, repo level only when needed should be possible (maybe we need a fallback batch to make 100% sure we are in sync, but while developing it is needed to run only what is needed to keep everything fast and workable)

i have the feeling that making running the test and its status part of the graph could maybe be an elegant option to handle this

think very hard about this and give me a very detailed plan with only the why and how on how to tackle this. no planning or other to wordy stuff just the core ideas and how to tackle this

if needed to research on how other tackle this in a similar context as we are in.

create this spec as file docs/development/devac-validate-spec.md





## build it prompt

[@devac-validate-spec.md](file:///Users/grop/ws/CodeGraph/docs/development/devac-validate-spec.md) can you do a thorough review of the given spec file and together with a thorough review of the current code base create a plan to implement this. think hard and keep it elegant and do not overengineer it. try to keep a tdd mindset.
to understand the impact of this implementation we would like mermaid diagrams explaining the core concepts and ideas. this to understand what and how while building this and be able to validate whats created fully. this to make sure we create a high quality solution that is usable in practice.
create the plan as file docs/development/devac-validate-implementation-plan.md
