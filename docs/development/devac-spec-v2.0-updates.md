
we want to address the critical high risk of Per-File vs Per-Package Parquet Strategy mentioned in CodeGraph/docs/development/devac-spec-v2.0-review-recap.md
if further details are needed you can look at CodeGraph/docs/development/devac-spec-v2.0-review-claude.md
CodeGraph/docs/development/devac-spec-v2.0-review-gpt.md
CodeGraph/docs/development/devac-spec-v2.0-review-gemini.md
CodeGraph/docs/development/devac-spec-v2.0-review-doc.md

the amount of duckdb parquet files feel unmanageble with the large amount of files generated per source file.

we want fast updates and we want fast queries

we think that adding branch as a concept could solve the issue and deliver a closer to how we work, less files and better functionality.

for example:

most of the repos and are on the development or main branch

some repos are worked on and use a specific branch as their current branch

so if parquet files are per package per branch we can have much less files to handle

changing a file in a branch only needs to update the parquet files for that package branch

what is needed is an update to the entityid to include branch also we need to determine if we want to have branch as a first class citizen or if it is just a property of the entityid. we need to look at alternatives and their pros and concepts

with parquet files stored in git we need to define what happens when we merge branches with different versions of the same package.
as we have the principle of being able to recreate parquet files from source we could recreate after merging the source and resolving all conflict before we update the parquet files. with a large number of files the regenerating all files will take  time so we need to evaluate the performance impact of this approach. 
we could determine if regenerating files can be made faster by only parsing a file if the result will change, 
would hashing a file and knowing if the file hash changed from previous parse as a fundamental part of parsing and updating the nodes,edges,external-refs make the process substantial faster?

lets do some research so we can do a proper update of the specs based of analysing and researching this idea thoroughly
