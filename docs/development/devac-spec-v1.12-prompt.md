we want to create an updated spec based on 
CodeGraph/docs/development/devac-spec-v1.11.md
CodeGraph/docs/development/devac-spec-v1.11-docs.md
CodeGraph/docs/development/devac-spec-v1.11-review-piet.md
CodeGraph/docs/development/devac-spec-v1.11-db-redesign.md

the v1.11 spec as based on previous efforts and reviews but now with a new database design based on postgresql instead of neo4j.
we think using basic postgresql with its CTE an JSONB support is for the first version (se we will not use extensions like AGE, pg_vector or full text search in the beginning, in the future we can use them when needed).
