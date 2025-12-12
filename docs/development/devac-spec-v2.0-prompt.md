i want to create CodeGraph/docs/development/devac-spec-v2.0.md with the v2.0 spec for devac

please take a thorough look at the current code.
the avaluate the current v1.11 spec and its reviews and the db redesign proposal.

as we think that this is not the correct approach forward we want to take a step back and create a federated architecture for devac/codegraph.

take a thorough look at CodeGraph/docs/development/devac-spec-v1.12-federated-architecture-v4.md
and CodeGraph/docs/development/devac-spec-v1.12-validation-pipeline-v2.1.1.md
CodeGraph/docs/development/devac-spec-v1.12-codegraph-centric-validation-deep-analysis.md

what we want is to Build the complete three-layer federated system (Package Seeds → Repository Manifest → Central Hub) with DuckDB + Parquet as the storage layer.

this will give us Symbol-level dependency precision, no data duplication, direct Parquet queries across repos, LLM-optimized output.

we accept that this is a Large scope change from current v1.11 direction. Most architectural investment upfront.
please do note that we did NOT implement v1.11 and that the current code is in a state with the POC not integrated.
but with the big architectural change and its simplicication and more local project level work that is federated with out the need to copy we think the end result is simpler and better maintainable.

the CodeGraph/docs/development/devac-spec-v1.12-codegraph-centric-validation-deep-analysis.md suggestion to have the seed parquaet files per source file to get fast incremental changes in i think an elegant way (my question is is duckdb capable of handling the amount of parquet files with the same performance) is something we need to verify and validate in the implementation by creating test that make it possible to choose based on trying it out.

so we think duckdb with nodes, edges per file in parquet files is the way to go (but we need to verify this with tests)

multi language is needed but we can focus on typescript and python first with C# as the next step.

so lets create the v2.0 spec as a very thorough high level high quality spec (we will do the details later) and make sure to include documentation with the needed diagrams to make it understandable and reviewable by me.

feel free to as kfor details you need answered if that helps you create a better spec.
