# State lives in the Terrakube workspace of the same name. The workspace is
# declared in infra-terrkube (03-terrakube/workspaces.tf, fed from Doppler's
# TERRAKUBE_WORKSPACES_VCS) with folder = "tofu" and iac_type = "tofu".
#
# CHANGE ME: the workspace name must match this repo's workspace.
terraform {
  backend "remote" {
    hostname     = "terrakube-api.topia.io"
    organization = "topia-mgmt"

    workspaces {
      name = "sdk-ai-boilerplate"
    }
  }
}
