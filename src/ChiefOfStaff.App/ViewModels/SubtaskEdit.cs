using CommunityToolkit.Mvvm.ComponentModel;

namespace ChiefOfStaff.App.ViewModels;

public partial class SubtaskEdit : ObservableObject
{
    public int Id { get; init; }

    [ObservableProperty]
    public partial string Title { get; set; } = "";

    [ObservableProperty]
    public partial bool IsDone { get; set; }
}
