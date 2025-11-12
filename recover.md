ok we where working with dev-status-spec.md we created a phase -1 that is lost it seems (we did not update the spec)
the latest commit does show what we did and we should retrieve the spec from it.
the update originated from us detecting that
the different services have a different scope where codegraph services have a list of directories and run a repo level.
typescript, lint and test run per repo and or per package.
we implemented the stage where we analise the repos and determine the best way to run them.
we need to sync with what is already implemented and create the spec update to include this
can you do a thorough analysis of the code and lets try to get the spec defined again
we also specified that the surrounding lines to inform the llm better about the context to it can determine the issue and fix it without needing further tool calls in most cases.
[@Image](zed:///agent/pasted-image)
lets see if we can get a plan to update the dev-status-spec.md before we try to continue
