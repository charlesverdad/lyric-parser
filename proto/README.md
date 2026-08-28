# ProPresenter protocol buffer definitions

ProPresenter 7 and later (versions 17, 18, 19, 21, …) store `.pro` documents as
serialised Google Protocol Buffers rather than XML. These `.proto` files are the
dependency closure of `presentation.proto` — everything needed to describe a
song document and nothing else.

They come from [greyshirtguy/ProPresenter7-Proto](https://github.com/greyshirtguy/ProPresenter7-Proto),
whose `autogen-proto` directory is regenerated from each ProPresenter release.
The snapshot vendored here is recorded in `PROPRESENTER_VERSION.txt`.

These are unofficial, reverse-engineered definitions and are not supported by
Renewed Vision. They are used in two places:

- as the reference for the field numbers hard-coded in `js/propresenter.js`
- by `tools/check-pro.mjs`, which decodes every generated `.pro` with
  `protoc --decode=rv.data.Presentation` so a malformed document fails CI

The browser app does **not** load these files; it writes protobuf wire format
directly, so no protobuf runtime ships to users.
