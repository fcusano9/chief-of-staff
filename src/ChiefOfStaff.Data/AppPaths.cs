namespace ChiefOfStaff.Data;

public static class AppPaths
{
    public static string DataFolder { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChiefOfStaff");

    public static string DatabasePath => Path.Combine(DataFolder, "chiefofstaff.db");
    public static string SettingsPath => Path.Combine(DataFolder, "settings.json");

    /// <summary>OneDrive for Business folder if present, else personal OneDrive, else Documents.</summary>
    public static string DefaultBackupFolder
    {
        get
        {
            var root = Environment.GetEnvironmentVariable("OneDriveCommercial")
                       ?? Environment.GetEnvironmentVariable("OneDrive")
                       ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            return Path.Combine(root, "Chief of Staff Backups");
        }
    }
}
