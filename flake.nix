{
  inputs.nixpkgs.url = "nixpkgs";

  outputs =
    { self, nixpkgs }:
    {
      devShells.x86_64-linux.default =
        let
          pkgs = import nixpkgs { system = "x86_64-linux"; };
          npmScripts = pkgs.symlinkJoin {
            name = "npm-scripts";
            paths = map (cmd: pkgs.writeShellScriptBin cmd "bun run ${cmd}") [
              "serve"
              "build"
              "prepare-dev"
              "sync-files"
              "watch"
              "update-pages"
              "fetch-google-reviews"
              "clean"
            ];
          };
        in
        pkgs.mkShell {
          buildInputs = [
            pkgs.bun
            npmScripts
          ];
          shellHook = ''
            git pull
          '';
        };
    };
}
