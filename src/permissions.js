// Role and permission helpers.
// Loaded before app.js and exposed through window.KomponentDB.permissions.
(function(){
  const root = window.KomponentDB = window.KomponentDB || {};

  const ROLE_USER = "user";
  const ROLE_ALLOCATOR = "allocator";
  const ROLE_ADMIN = "admin";

  function normalizeRole(role){
    const raw = String(role || ROLE_USER).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if(raw === ROLE_ADMIN) return ROLE_ADMIN;
    if(["allocator", "planner", "semi_admin", "semiadmin", "editor", "manager"].includes(raw)) return ROLE_ALLOCATOR;
    return ROLE_USER;
  }

  function roleLabel(role){
    const r = normalizeRole(role);
    if(r === ROLE_ADMIN) return "admin";
    if(r === ROLE_ALLOCATOR) return "planner";
    return "visning";
  }

  function createPermissionHelpers(deps){
    const getCurrentUser = deps.getCurrentUser;
    const normalizeTagStatus = deps.normalizeTagStatus;
    const TAG_STATUS = deps.TAG_STATUS;

    function canAllocateNumbers(user = getCurrentUser()){
      const role = normalizeRole(user?.role);
      return role === ROLE_ADMIN || role === ROLE_ALLOCATOR;
    }

    function isPlannerOnly(user = getCurrentUser()){
      return normalizeRole(user?.role) === ROLE_ALLOCATOR;
    }

    function canManageUsers(user = getCurrentUser()){
      return normalizeRole(user?.role) === ROLE_ADMIN;
    }

    function canCreateRecords(user = getCurrentUser()){
      const role = normalizeRole(user?.role);
      return role === ROLE_ADMIN || role === ROLE_ALLOCATOR;
    }

    function canImportData(user = getCurrentUser()){
      return canManageUsers(user);
    }

    function canScanPaper(user = getCurrentUser()){
      return canManageUsers(user);
    }

    function canExportBackup(user = getCurrentUser()){
      return canManageUsers(user);
    }

    function canSaveRecords(user = getCurrentUser()){
      const role = normalizeRole(user?.role);
      return role === ROLE_ADMIN || role === ROLE_ALLOCATOR;
    }

    function canUseStatus(mark, user = getCurrentUser()){
      const status = normalizeTagStatus(mark);
      if(canManageUsers(user)) return true;
      return isPlannerOnly(user) && status === TAG_STATUS.RESERVED;
    }

    return {
      canAllocateNumbers,
      isPlannerOnly,
      canManageUsers,
      canCreateRecords,
      canImportData,
      canScanPaper,
      canExportBackup,
      canSaveRecords,
      canUseStatus,
    };
  }

  root.permissions = {
    ROLE_USER,
    ROLE_ALLOCATOR,
    ROLE_ADMIN,
    normalizeRole,
    roleLabel,
    createPermissionHelpers,
  };
})();
