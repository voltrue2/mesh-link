PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

## Set default command of make to help, so that running make will output help texts
.DEFAULT_GOAL := help

setup: ## Set up working environment
	ln -fs ../../scripts/pre-commit .git/hooks/pre-commit

lint: ## Execute lint against the source code
	./bin/lint 

.PHONY: test
test: ## Exevute unit tests
	./bin/lint || exit 1
	./node_modules/mocha/bin/mocha test/index.js --exit -s 10 -R spec -b --timeout 11000 

