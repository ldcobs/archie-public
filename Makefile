# Archie — developer tasks.

VERSION ?= 0.1.5

.PHONY: package
package:           ## Build the clean golden-image tarball (dist/archie-<version>.tgz)
	@bash build/package.sh $(VERSION)

.PHONY: release
release:           ## Build (PUSH=1 to publish) the pre-built Option B images
	@bash build/release.sh $(VERSION)

.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'
