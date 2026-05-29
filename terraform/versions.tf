terraform {
  required_version = ">= 1.11.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "~> 5.3"
    }
  }

  backend "http" {}
}