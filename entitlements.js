// One map of who can do what. The static page calls checkEntitlement with no record,
// which is the same result as a free record: the day still plays, and paid actions do not.
(function (root) {
  var ACTIONS = {
    brief: "free",
    "play-day": "free",
    shuffle: "paid",
    reroll: "paid",
    "save-day": "paid",
    "deep-filter": "paid",
    "request-city": "paid"
  };

  function tierOf(record) {
    if (!record || typeof record !== "object") return "free";
    if (record.tier === "paid") return "paid";
    return "free";
  }

  function checkEntitlement(input) {
    input = input || {};
    var action = input.action;
    var need = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : "";
    var tier = "free";
    try {
      tier = tierOf(input.record);
    } catch (e) {
      tier = "free";
    }
    if (!need) return { allowed: false, action: action };
    if (tier === "paid") return { allowed: true, action: action };
    if (need === "free") return { allowed: true, action: action };
    if (action === "request-city" && input.cityStatus === "free") return { allowed: true, action: action };
    return { allowed: false, action: action };
  }

  root.checkEntitlement = checkEntitlement;
  root.ENTITLEMENT_ACTIONS = ACTIONS;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { checkEntitlement: checkEntitlement, ENTITLEMENT_ACTIONS: ACTIONS };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
