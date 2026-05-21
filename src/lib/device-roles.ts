// Single source of truth for Meshtastic device roles. The numeric values
// match Config.DeviceConfig.Role in the firmware protobuf. Keep this in
// sync with upstream when new roles are added — every panel that lets
// the user pick a role or renders one reads from here.
//
// Reference: https://github.com/meshtastic/protobufs (config.proto)

export interface DeviceRoleSpec {
  value: number;
  label: string;
  hint: string;
}

export const DEVICE_ROLES: DeviceRoleSpec[] = [
  { value: 0,  label: 'CLIENT',         hint: 'default · normal user node' },
  { value: 1,  label: 'CLIENT_MUTE',    hint: 'receive-only · won\'t rebroadcast' },
  { value: 2,  label: 'ROUTER',         hint: 'deprecated · prefer ROUTER_LATE on 2.6+ firmware' },
  { value: 3,  label: 'ROUTER_CLIENT',  hint: 'deprecated · use CLIENT or ROUTER_LATE' },
  { value: 4,  label: 'REPEATER',       hint: 'just rebroadcasts · doesn\'t appear as a user' },
  { value: 5,  label: 'TRACKER',        hint: 'low-power GPS beacon mode' },
  { value: 6,  label: 'SENSOR',         hint: 'periodic telemetry broadcaster' },
  { value: 7,  label: 'TAK',            hint: 'TAK client integration' },
  { value: 8,  label: 'CLIENT_HIDDEN',  hint: 'normal node but suppressed from others\' nodeDBs' },
  { value: 9,  label: 'LOST_AND_FOUND', hint: 'shouts location on a fixed channel' },
  { value: 10, label: 'TAK_TRACKER',    hint: 'TAK + tracker' },
  { value: 11, label: 'ROUTER_LATE',    hint: 'router that defers to other routers · fills coverage gaps' },
  { value: 12, label: 'CLIENT_BASE',    hint: 'home base station · CLIENT behaviour + rebroadcasts like a router' },
];

/** value → display name (e.g. `2 → "ROUTER"`). */
export const ROLE_NAMES: Record<number, string> = Object.fromEntries(
  DEVICE_ROLES.map((r) => [r.value, r.label]),
);

/** value → spec (label + hint), or undefined for unknown roles. */
export function roleSpec(value: number | undefined): DeviceRoleSpec | undefined {
  if (value === undefined) return undefined;
  return DEVICE_ROLES.find((r) => r.value === value);
}
