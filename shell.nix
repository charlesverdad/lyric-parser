{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  name = "lyric-parser";

  buildInputs = with pkgs; [
    nodejs_22
    just
    poppler_utils   # pdftotext / pdfinfo - PDF inspection during development
    protobuf        # protoc - validates generated .pro files against ProPresenter protos
    git
    gh
  ];

  shellHook = ''
    echo "lyric-parser dev shell - node $(node --version), protoc $(protoc --version)"
  '';
}
