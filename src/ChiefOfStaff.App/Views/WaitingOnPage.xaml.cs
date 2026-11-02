using ChiefOfStaff.App.ViewModels;
using ChiefOfStaff.Data.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace ChiefOfStaff.App.Views;

public sealed partial class WaitingOnPage : Page
{
    public WaitingOnPage() => InitializeComponent();

    protected override async void OnNavigatedTo(NavigationEventArgs e) => await LoadAsync();

    private async Task LoadAsync()
    {
        var items = await App.Get<WorkItemService>().GetWaitingAsync();
        WaitingList.ItemsSource = items.Select(w => new TaskRowViewModel(w)).ToList();
        EmptyText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void Task_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is TaskRowViewModel row && await TaskDialog.ShowForAsync(XamlRoot, row.Id)) await LoadAsync();
    }
}
