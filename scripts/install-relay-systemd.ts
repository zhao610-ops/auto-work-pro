import {
  parseRelaySystemdArgs,
  renderRelaySystemdUnit,
} from "./print-relay-systemd.ts";

interface InstallOptions {
  serviceName: string;
  dryRun: boolean;
  noStart: boolean;
}

const installOptions = parseInstallOptions(Deno.args);
const commonArgs = pickCommonSystemdArgs(Deno.args);
const defaultUser = currentLoginUser();
const unitOptions = parseRelaySystemdArgs(commonArgs, {
  user: defaultUser,
  group: defaultUser,
});
const unit = renderRelaySystemdUnit(unitOptions);
const serviceFile = `/etc/systemd/system/${installOptions.serviceName}.service`;

if (installOptions.dryRun) {
  console.log(`# Would write: ${serviceFile}\n${unit}`);
  Deno.exit(0);
}

if (Deno.build.os !== "linux") {
  throw new Error("relay install 只支持 Linux systemd 环境");
}

await writeServiceFile(serviceFile, unit);
await runPrivileged("systemctl", ["daemon-reload"]);

if (!installOptions.noStart) {
  const unitName = `${installOptions.serviceName}.service`;
  await runPrivileged("systemctl", ["enable", unitName]);
  await runPrivileged("systemctl", ["restart", unitName]);
}

console.log(`relay systemd 服务已安装: ${installOptions.serviceName}`);
console.log(`查看状态: sudo systemctl status ${installOptions.serviceName}`);
console.log(`查看日志: sudo journalctl -u ${installOptions.serviceName} -f`);

function parseInstallOptions(args: string[]): InstallOptions {
  return {
    serviceName: readStringArg(args, "service-name") ??
      "trendpublish-weixin-relay",
    dryRun: hasFlag(args, "dry-run"),
    noStart: hasFlag(args, "no-start"),
  };
}

function pickCommonSystemdArgs(args: string[]): string[] {
  const names = new Set(["workdir", "config", "deno", "port", "user", "group"]);
  const result: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const name = rawName.trim();
    if (!names.has(name)) {
      if (
        inlineValue === undefined && args[index + 1]?.startsWith("--") === false
      ) {
        index++;
      }
      continue;
    }

    if (inlineValue !== undefined) {
      result.push(`--${name}=${inlineValue}`);
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 --${name} 需要提供值`);
    }
    result.push(`--${name}`, value);
    index++;
  }

  return result;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function readStringArg(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}`) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`参数 --${name} 需要提供值`);
      }
      return value;
    }
  }
  return undefined;
}

function currentLoginUser(): string {
  return Deno.env.get("SUDO_USER") ??
    Deno.env.get("USER") ??
    Deno.env.get("LOGNAME") ??
    "trendpublish";
}

async function writeServiceFile(path: string, content: string): Promise<void> {
  if (isRoot()) {
    await Deno.writeTextFile(path, content + "\n");
    return;
  }

  await runPrivileged("tee", [path], content + "\n", { hideStdout: true });
}

async function runPrivileged(
  command: string,
  args: string[],
  input?: string,
  options: { hideStdout?: boolean } = {},
): Promise<void> {
  const fullCommand = isRoot() ? command : "sudo";
  const fullArgs = isRoot() ? args : [command, ...args];
  const child = new Deno.Command(fullCommand, {
    args: fullArgs,
    stdin: input ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  if (input) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
  }

  const output = await child.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();

  if (!output.success) {
    throw new Error(
      `${fullCommand} ${fullArgs.join(" ")} 执行失败` +
        (stderr ? `: ${stderr}` : ""),
    );
  }

  if (stdout && !options.hideStdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

function isRoot(): boolean {
  return Deno.uid?.() === 0;
}
